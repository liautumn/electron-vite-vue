const normalizeHex = (input: string) =>
  input.replace(/\s+/g, '').toUpperCase()

const padHex = (value: number, length: number) =>
  value.toString(16).toUpperCase().padStart(length, '0')

export const crc16Ccitt = (hex: string) => {
  const clean = normalizeHex(hex)
  let crc = 0x0000
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16)
    crc ^= (byte << 8)
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xffff
    }
  }
  return padHex(crc, 4)
}
