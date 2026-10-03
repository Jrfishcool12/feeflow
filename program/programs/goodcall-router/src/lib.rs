//! GoodCall router.
//!
//! Every coin launched on GoodCall has this program's `authority` PDA as its Pump.fun
//! creator, so the PDA becomes the coin's fee-sharing admin. Only this program can sign
//! for the PDA, and it only ever writes one kind of split:
//!
//!   nonprofit donation escrow (DonationFeePda for this mint + chosen nonprofit) : charity_bps
//!   platform wallet                                                            : platform_bps
//!   buyback wallet                                                             : buyback_bps
//!
//! Wallets and percentages are fixed at `initialize` and can't change afterwards. The only
//! thing that can change is *which nonprofit* gets the charity share, and only with a fresh
//! signature from the attester (the GoodCall server, after the honoree logs in with X), at
//! most once per cooldown. So even someone holding the server's keys can't route fees to
//! themselves; the worst they could do is pick a different nonprofit.
//!
//! Pump.fun account lists are passed as remaining accounts, built off-chain with Pump's
//! official SDK. The program checks the accounts that matter, builds the instruction data
//! itself, and signs as the PDA.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

declare_id!("H1ATxqNn5Dc8dwMAKykZEae1mgd61Gq5UWt9JtKvJ2u6");

/// Pump.fun fee program (fee sharing, donation escrows).
/// pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ (checked by a unit test)
pub const PUMP_FEES: Pubkey = Pubkey::new_from_array([12, 53, 255, 169, 5, 90, 142, 86, 141, 168, 247, 188, 7, 86, 21, 39, 76, 241, 201, 44, 164, 31, 64, 0, 156, 81, 106, 164, 20, 194, 124, 112]);

const IX_CREATE_FEE_SHARING_CONFIG: [u8; 8] = [195, 78, 86, 76, 111, 52, 251, 213];
const IX_CREATE_DONATION_FEE_PDA: [u8; 8] = [244, 139, 16, 88, 14, 255, 122, 26];
const IX_UPDATE_FEE_SHARES: [u8; 8] = [189, 13, 136, 99, 187, 164, 237, 35];

pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const CONFIG_SEED: &[u8] = b"config";
pub const COIN_SEED: &[u8] = b"coin";
pub const ATTEST_DOMAIN: &[u8] = b"goodcall:set_charity:v1";

#[program]
pub mod goodcall_router {
    use super::*;

    /// One-time setup. Wallets and the split are permanent after this.
    pub fn initialize(
        ctx: Context<Initialize>,
        attester: Pubkey,
        platform_wallet: Pubkey,
        buyback_wallet: Pubkey,
        charity_bps: u16,
        platform_bps: u16,
        buyback_bps: u16,
        cooldown_secs: i64,
    ) -> Result<()> {
        require!(
            charity_bps as u32 + platform_bps as u32 + buyback_bps as u32 == 10_000 && charity_bps > 0,
            RouterError::BadSplit
        );
        require!(cooldown_secs >= 0, RouterError::BadCooldown);
        require_keys_neq!(platform_wallet, buyback_wallet, RouterError::DuplicateWallet);

        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.attester = attester;
        cfg.platform_wallet = platform_wallet;
        cfg.buyback_wallet = buyback_wallet;
        cfg.charity_bps = charity_bps;
        cfg.platform_bps = platform_bps;
        cfg.buyback_bps = buyback_bps;
        cfg.cooldown_secs = cooldown_secs;
        cfg.bump = ctx.bumps.config;
        cfg.authority_bump = ctx.bumps.authority;
        Ok(())
    }

    /// Rotate the attester key or change the cooldown. Can't touch wallets or percentages.
    pub fn update_config(ctx: Context<UpdateConfig>, attester: Pubkey, cooldown_secs: i64) -> Result<()> {
        require!(cooldown_secs >= 0, RouterError::BadCooldown);
        let cfg = &mut ctx.accounts.config;
        cfg.attester = attester;
        cfg.cooldown_secs = cooldown_secs;
        Ok(())
    }

    /// Step 1 after launch: turn on Pump.fun fee sharing, with the PDA as its admin.
    /// remaining_accounts = create_fee_sharing_config accounts.
    pub fn enable_sharing<'info>(ctx: Context<'_, '_, 'info, 'info, EnableSharing<'info>>) -> Result<()> {
        let mint = ctx.accounts.mint.key();
        let a = ctx.remaining_accounts;
        check_create_sharing(a, &mint)?;
        cpi(a, IX_CREATE_FEE_SHARING_CONFIG.to_vec(), ctx.accounts.config.authority_bump)
    }

    /// Creates a coin's donation escrow for a nonprofit without changing its split. Used for
    /// the house coin, whose escrows receive relayed donations. Escrows only ever pay out to
    /// the donation relay, so this can't move money anywhere else.
    /// remaining_accounts = create_donation_fee_pda accounts.
    pub fn create_escrow<'info>(ctx: Context<'_, '_, 'info, 'info, CreateEscrow<'info>>) -> Result<()> {
        let (mint, charity) = (ctx.accounts.mint.key(), ctx.accounts.charity_config.key());
        let b = ctx.remaining_accounts;
        check_create_escrow(b, &mint, &charity)?;
        cpi(b, IX_CREATE_DONATION_FEE_PDA.to_vec(), ctx.accounts.config.authority_bump)
    }

    /// Step 2: point the split at the starting nonprofit and record the honoree.
    /// remaining_accounts = [create_donation_fee_pda accounts (n_escrow; 0 if the escrow exists)]
    ///                    + [update_fee_shares accounts]
    pub fn activate<'info>(
        ctx: Context<'_, '_, 'info, 'info, Activate<'info>>,
        honoree_id_hash: [u8; 32],
        n_escrow: u8,
    ) -> Result<()> {
        let mint = ctx.accounts.mint.key();
        let charity = ctx.accounts.charity_config.key();
        let cfg = &ctx.accounts.config;
        let (b, c) = split(ctx.remaining_accounts, n_escrow)?;
        route(cfg, b, c, &mint, &charity)?;

        let coin = &mut ctx.accounts.coin;
        coin.mint = mint;
        coin.charity_config_id = charity;
        coin.honoree_id_hash = honoree_id_hash;
        coin.honoree_chose = false;
        coin.last_change_ts = Clock::get()?.unix_timestamp;
        coin.bump = ctx.bumps.coin;
        emit!(CharitySet { mint, charity_config_id: charity, by_honoree: false });
        Ok(())
    }

    /// The honoree picks a nonprofit. The instruction right before this one must be an
    /// Ed25519 check by the attester over:
    ///   sha256("goodcall:set_charity:v1" || mint || honoree_id_hash || nonprofit config id || expires_at (i64 LE))
    /// remaining_accounts = [create_donation_fee_pda accounts (n_escrow)] + [update_fee_shares accounts]
    pub fn set_charity<'info>(
        ctx: Context<'_, '_, 'info, 'info, SetCharity<'info>>,
        expires_at: i64,
        n_escrow: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now <= expires_at, RouterError::AttestationExpired);

        let mint = ctx.accounts.mint.key();
        let charity = ctx.accounts.charity_config.key();
        let cfg = &ctx.accounts.config;
        let coin = &ctx.accounts.coin;
        require_keys_neq!(charity, coin.charity_config_id, RouterError::SameCharity);
        if coin.honoree_chose {
            require!(now >= coin.last_change_ts.saturating_add(cfg.cooldown_secs), RouterError::Cooldown);
        }
        let msg = attestation_message(&mint, &coin.honoree_id_hash, &charity, expires_at);
        verify_attestation(&ctx.accounts.instructions, &cfg.attester, &msg)?;

        let (b, c) = split(ctx.remaining_accounts, n_escrow)?;
        route(cfg, b, c, &mint, &charity)?;

        let coin = &mut ctx.accounts.coin;
        coin.charity_config_id = charity;
        coin.honoree_chose = true;
        coin.last_change_ts = now;
        emit!(CharitySet { mint, charity_config_id: charity, by_honoree: true });
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + RouterConfig::SIZE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, RouterConfig>,
    /// CHECK: data-less PDA that signs as coin creator and fee-sharing admin. Fund it with SOL for rent.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, RouterConfig>,
}

#[derive(Accounts)]
pub struct EnableSharing<'info> {
    pub attester: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = attester)]
    pub config: Account<'info, RouterConfig>,
    /// CHECK: the coin's mint; checked against the Pump.fun accounts.
    pub mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CreateEscrow<'info> {
    pub attester: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = attester)]
    pub config: Account<'info, RouterConfig>,
    /// CHECK: the coin's mint; checked against the Pump.fun accounts.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: donate.gg config id; checked against the escrow derivation.
    pub charity_config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Activate<'info> {
    #[account(mut)]
    pub attester: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = attester)]
    pub config: Account<'info, RouterConfig>,
    #[account(init, payer = attester, space = 8 + CoinRecord::SIZE, seeds = [COIN_SEED, mint.key().as_ref()], bump)]
    pub coin: Account<'info, CoinRecord>,
    /// CHECK: the coin's mint; checked against the Pump.fun accounts.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: donate.gg config id for the nonprofit; checked against the escrow derivation.
    pub charity_config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetCharity<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, RouterConfig>,
    #[account(mut, seeds = [COIN_SEED, mint.key().as_ref()], bump = coin.bump, has_one = mint)]
    pub coin: Account<'info, CoinRecord>,
    /// CHECK: the coin's mint (bound by the coin record's seeds and has_one).
    pub mint: UncheckedAccount<'info>,
    /// CHECK: donate.gg config id for the new nonprofit; covered by the attestation and escrow derivation.
    pub charity_config: UncheckedAccount<'info>,
    /// CHECK: instructions sysvar, to read the Ed25519 check before this instruction.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[account]
pub struct RouterConfig {
    pub admin: Pubkey,
    pub attester: Pubkey,
    pub platform_wallet: Pubkey,
    pub buyback_wallet: Pubkey,
    pub charity_bps: u16,
    pub platform_bps: u16,
    pub buyback_bps: u16,
    pub cooldown_secs: i64,
    pub bump: u8,
    pub authority_bump: u8,
}
impl RouterConfig {
    pub const SIZE: usize = 32 * 4 + 2 * 3 + 8 + 1 + 1;
}

#[account]
pub struct CoinRecord {
    pub mint: Pubkey,
    pub charity_config_id: Pubkey,
    /// sha256 of the honoree's numeric X user id
    pub honoree_id_hash: [u8; 32],
    pub honoree_chose: bool,
    pub last_change_ts: i64,
    pub bump: u8,
}
impl CoinRecord {
    pub const SIZE: usize = 32 * 3 + 1 + 8 + 1;
}

#[event]
pub struct CharitySet {
    pub mint: Pubkey,
    pub charity_config_id: Pubkey,
    pub by_honoree: bool,
}

#[error_code]
pub enum RouterError {
    #[msg("Charity, platform and buyback shares must add up to 100%, with a nonzero charity share")]
    BadSplit,
    #[msg("Cooldown can't be negative")]
    BadCooldown,
    #[msg("Platform and buyback wallets must differ")]
    DuplicateWallet,
    #[msg("Account list is shorter than the lengths given")]
    BadAccountSplit,
    #[msg("A Pump.fun account doesn't match what this coin requires")]
    BadPumpAccount,
    #[msg("Missing or invalid attester signature")]
    BadAttestation,
    #[msg("The attestation has expired")]
    AttestationExpired,
    #[msg("The honoree changed nonprofits too recently")]
    Cooldown,
    #[msg("Fees already go to that nonprofit")]
    SameCharity,
}

// ---------------------------------------------------------------- helpers

fn split<'a, 'info>(accts: &'a [AccountInfo<'info>], n: u8) -> Result<(&'a [AccountInfo<'info>], &'a [AccountInfo<'info>])> {
    let n = n as usize;
    require!(accts.len() >= n, RouterError::BadAccountSplit);
    Ok(accts.split_at(n))
}

pub fn authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[AUTHORITY_SEED], &crate::ID).0
}

pub fn sharing_config_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"sharing-config", mint.as_ref()], &PUMP_FEES).0
}

pub fn donation_escrow_pda(mint: &Pubkey, charity: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"donation-fee-pda", mint.as_ref(), charity.as_ref()], &PUMP_FEES).0
}

/// The 32-byte message the attester signs: sha256 of the fields, so the Ed25519 check stays
/// small enough to fit in one transaction with the fee-sharing update.
pub fn attestation_message(mint: &Pubkey, honoree_id_hash: &[u8; 32], charity: &Pubkey, expires_at: i64) -> [u8; 32] {
    anchor_lang::solana_program::hash::hashv(&[ATTEST_DOMAIN, mint.as_ref(), honoree_id_hash, charity.as_ref(), &expires_at.to_le_bytes()]).to_bytes()
}

fn key_at(accts: &[AccountInfo], i: usize) -> Result<Pubkey> {
    accts.get(i).map(|a| a.key()).ok_or(error!(RouterError::BadPumpAccount))
}

// Account positions follow Pump.fun's fee-program IDL.
fn check_create_sharing(a: &[AccountInfo], mint: &Pubkey) -> Result<()> {
    require_keys_eq!(key_at(a, 1)?, PUMP_FEES, RouterError::BadPumpAccount);
    require_keys_eq!(key_at(a, 2)?, authority_pda(), RouterError::BadPumpAccount); // payer = coin creator
    require_keys_eq!(key_at(a, 4)?, *mint, RouterError::BadPumpAccount);
    require_keys_eq!(key_at(a, 5)?, sharing_config_pda(mint), RouterError::BadPumpAccount);
    Ok(())
}

fn check_create_escrow(b: &[AccountInfo], mint: &Pubkey, charity: &Pubkey) -> Result<()> {
    require_keys_eq!(key_at(b, 1)?, PUMP_FEES, RouterError::BadPumpAccount);
    require_keys_eq!(key_at(b, 2)?, authority_pda(), RouterError::BadPumpAccount);
    require_keys_eq!(key_at(b, 5)?, donation_escrow_pda(mint, charity), RouterError::BadPumpAccount);
    require_keys_eq!(key_at(b, 6)?, *charity, RouterError::BadPumpAccount);
    require_keys_eq!(key_at(b, 7)?, *mint, RouterError::BadPumpAccount);
    Ok(())
}

fn check_update_shares(c: &[AccountInfo], mint: &Pubkey) -> Result<()> {
    require_keys_eq!(key_at(c, 1)?, PUMP_FEES, RouterError::BadPumpAccount);
    require_keys_eq!(key_at(c, 2)?, authority_pda(), RouterError::BadPumpAccount);
    require_keys_eq!(key_at(c, 4)?, *mint, RouterError::BadPumpAccount);
    require_keys_eq!(key_at(c, 5)?, sharing_config_pda(mint), RouterError::BadPumpAccount);
    Ok(())
}

fn route(cfg: &RouterConfig, escrow_accts: &[AccountInfo], update_accts: &[AccountInfo], mint: &Pubkey, charity: &Pubkey) -> Result<()> {
    if !escrow_accts.is_empty() {
        check_create_escrow(escrow_accts, mint, charity)?;
        cpi(escrow_accts, IX_CREATE_DONATION_FEE_PDA.to_vec(), cfg.authority_bump)?;
    }
    check_update_shares(update_accts, mint)?;
    cpi(update_accts, update_shares_data(cfg, mint, charity), cfg.authority_bump)
}

/// The only split this program ever writes. Built here, never taken from the caller.
pub fn update_shares_data(cfg: &RouterConfig, mint: &Pubkey, charity: &Pubkey) -> Vec<u8> {
    let mut shares: Vec<(Pubkey, u16)> = vec![(donation_escrow_pda(mint, charity), cfg.charity_bps)];
    if cfg.platform_bps > 0 {
        shares.push((cfg.platform_wallet, cfg.platform_bps));
    }
    if cfg.buyback_bps > 0 {
        shares.push((cfg.buyback_wallet, cfg.buyback_bps));
    }
    let mut data = IX_UPDATE_FEE_SHARES.to_vec();
    data.extend_from_slice(&(shares.len() as u32).to_le_bytes());
    for (addr, bps) in shares {
        data.extend_from_slice(addr.as_ref());
        data.extend_from_slice(&bps.to_le_bytes());
    }
    data
}

/// Invokes a Pump.fun fee-program instruction over `accts`, signing as the authority PDA.
fn cpi(accts: &[AccountInfo], data: Vec<u8>, authority_bump: u8) -> Result<()> {
    let authority = authority_pda();
    let metas = accts
        .iter()
        .map(|a| AccountMeta { pubkey: a.key(), is_signer: a.is_signer || a.key() == authority, is_writable: a.is_writable })
        .collect();
    let ix = Instruction { program_id: PUMP_FEES, accounts: metas, data };
    invoke_signed(&ix, accts, &[&[AUTHORITY_SEED, &[authority_bump]]])?;
    Ok(())
}

/// Checks that the instruction right before this one is an Ed25519 verification of exactly
/// `msg`, signed by `attester`, with every piece of data inside that same instruction.
fn verify_attestation(ix_sysvar: &AccountInfo, attester: &Pubkey, msg: &[u8]) -> Result<()> {
    let current = load_current_index_checked(ix_sysvar)?;
    require!(current > 0, RouterError::BadAttestation);
    let ed = load_instruction_at_checked((current - 1) as usize, ix_sysvar)?;
    require_keys_eq!(ed.program_id, ed25519_program::ID, RouterError::BadAttestation);
    check_ed25519_data(&ed.data, attester, msg)
}

/// Parses an Ed25519 program instruction (one signature) and checks signer and message.
pub fn check_ed25519_data(d: &[u8], attester: &Pubkey, msg: &[u8]) -> Result<()> {
    require!(d.len() >= 16 && d[0] == 1, RouterError::BadAttestation);
    let u16_at = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]);
    let (sig_off, sig_ix) = (u16_at(2) as usize, u16_at(4));
    let (pk_off, pk_ix) = (u16_at(6) as usize, u16_at(8));
    let (msg_off, msg_len, msg_ix) = (u16_at(10) as usize, u16_at(12) as usize, u16_at(14));
    require!(sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX, RouterError::BadAttestation);
    require!(sig_off + 64 <= d.len() && pk_off + 32 <= d.len() && msg_off + msg_len <= d.len(), RouterError::BadAttestation);
    require!(&d[pk_off..pk_off + 32] == attester.as_ref(), RouterError::BadAttestation);
    require!(&d[msg_off..msg_off + msg_len] == msg, RouterError::BadAttestation);
    Ok(())
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> RouterConfig {
        RouterConfig {
            admin: Pubkey::new_unique(),
            attester: Pubkey::new_unique(),
            platform_wallet: Pubkey::new_unique(),
            buyback_wallet: Pubkey::new_unique(),
            charity_bps: 9_000,
            platform_bps: 500,
            buyback_bps: 500,
            cooldown_secs: 30 * 86_400,
            bump: 255,
            authority_bump: 255,
        }
    }

    /// Builds Ed25519 instruction data the way @solana/web3.js does (single signature, inline data).
    fn ed_data(pubkey: &Pubkey, msg: &[u8]) -> Vec<u8> {
        let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
        let mut d = vec![1u8, 0];
        for v in [sig_off, u16::MAX, pk_off, u16::MAX, msg_off, msg.len() as u16, u16::MAX] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(pubkey.as_ref());
        d.extend_from_slice(&[7u8; 64]); // signature bytes; the runtime checks them, not us
        d.extend_from_slice(msg);
        d
    }

    #[test]
    fn split_is_escrow_then_platform_then_buyback() {
        let c = cfg();
        let (mint, charity) = (Pubkey::new_unique(), Pubkey::new_unique());
        let data = update_shares_data(&c, &mint, &charity);
        assert_eq!(&data[..8], &IX_UPDATE_FEE_SHARES);
        assert_eq!(u32::from_le_bytes(data[8..12].try_into().unwrap()), 3);
        let entry = |i: usize| {
            let s = 12 + i * 34;
            (Pubkey::try_from(&data[s..s + 32]).unwrap(), u16::from_le_bytes([data[s + 32], data[s + 33]]))
        };
        assert_eq!(entry(0), (donation_escrow_pda(&mint, &charity), 9_000));
        assert_eq!(entry(1), (c.platform_wallet, 500));
        assert_eq!(entry(2), (c.buyback_wallet, 500));
        assert_eq!(data.len(), 12 + 3 * 34);
    }

    #[test]
    fn zero_shares_are_left_out() {
        let mut c = cfg();
        (c.charity_bps, c.platform_bps, c.buyback_bps) = (10_000, 0, 0);
        let data = update_shares_data(&c, &Pubkey::new_unique(), &Pubkey::new_unique());
        assert_eq!(u32::from_le_bytes(data[8..12].try_into().unwrap()), 1);
    }

    #[test]
    fn attestation_accepts_only_the_attester_and_the_exact_message() {
        let attester = Pubkey::new_unique();
        let msg = attestation_message(&Pubkey::new_unique(), &[9u8; 32], &Pubkey::new_unique(), 1_800_000_000);
        assert!(check_ed25519_data(&ed_data(&attester, &msg), &attester, &msg).is_ok());
        assert!(check_ed25519_data(&ed_data(&Pubkey::new_unique(), &msg), &attester, &msg).is_err());
        let mut other = msg;
        other[31] ^= 1;
        assert!(check_ed25519_data(&ed_data(&attester, &other), &attester, &msg).is_err());
    }

    #[test]
    fn attestation_rejects_data_pulled_from_other_instructions() {
        let attester = Pubkey::new_unique();
        let msg = attestation_message(&Pubkey::new_unique(), &[1u8; 32], &Pubkey::new_unique(), 1);
        let mut d = ed_data(&attester, &msg);
        d[8..10].copy_from_slice(&0u16.to_le_bytes()); // public key "from instruction 0"
        assert!(check_ed25519_data(&d, &attester, &msg).is_err());
    }

    #[test]
    fn pump_fees_id_is_right() {
        assert_eq!(PUMP_FEES.to_string(), "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
    }

    #[test]
    fn escrow_depends_on_nonprofit() {
        let mint = Pubkey::new_unique();
        assert_ne!(donation_escrow_pda(&mint, &Pubkey::new_unique()), donation_escrow_pda(&mint, &Pubkey::new_unique()));
    }
}

#[cfg(test)]
mod parity {
    use super::*;
    /// Same inputs as server/src/router.ts produces for the parity check in the README.
    #[test]
    fn attestation_digest_matches_server() {
        let mint = Pubkey::new_from_array([1u8; 32]);
        let charity = Pubkey::new_from_array([2u8; 32]);
        let honoree: [u8; 32] = anchor_lang::solana_program::hash::hash(b"44196397").to_bytes();
        let d = attestation_message(&mint, &honoree, &charity, 1_900_000_000);
        let hex: String = d.iter().map(|b| format!("{:02x}", b)).collect();
        // Computed independently by the server's TypeScript (router.ts `attestation`).
        assert_eq!(hex, "c71207041ad1b7231e1d3543ac6a48ee21624e9317fd03458a2d8f88798cf979");
    }
}
