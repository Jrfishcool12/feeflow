// The one function FeeFlow uses from the qrcode package (draws the wallet address QR code).
declare module "qrcode" {
  export function toDataURL(text: string, options?: { margin?: number; width?: number; color?: { dark?: string; light?: string } }): Promise<string>;
  const QRCode: { toDataURL: typeof toDataURL };
  export default QRCode;
}
