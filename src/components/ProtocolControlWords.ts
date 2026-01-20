/**
 * UHF RFID 读写器协议 - 协议控制字生成工具（TypeScript）
 *
 * 根据传入的字段参数，计算出 32 位协议控制字（big-endian 字节序）
 * 支持返回：
 *   - 32 位整数（number）
 *   - 十六进制字符串（如 "00010110"）
 *   - Uint8Array（4 字节，big-endian，适合直接发送）
 */

interface ControlWordParams {
  /** 协议类型号 (bit 31-24)，默认 0（UHF RFID 读写器协议） */
  protocolType?: number;       // 0 | 15 等，范围 0~255
  /** 协议版本号 (bit 23-16)，默认 1（即 0x01） */
  protocolVersion?: number;    // 通常为 1
  /** RS485 标志位 (bit 13)，0 或 1 */
  rs485Flag?: 0 | 1;
  /** 读写器主动上传标志位 (bit 12)，0 或 1 */
  uploadFlag?: 0 | 1;
  /** 消息类别号 (bit 11-8)，0~5 常用 */
  messageCategory: number;     // 必须传入，0~15（协议中 0~5 有定义）
  /** 消息 ID (bit 7-0)，0x00~0xFF */
  messageId: number;           // 必须传入，0~255
}

/**
 * 生成协议控制字
 * @param params 参数对象
 * @returns 对象包含多种格式的结果
 */
function generateControlWord(params: ControlWordParams): {
  value: number;                    // 32 位整数
  hex: string;                      // 8 位十六进制字符串（大写，无前缀）
  bytes: Uint8Array;                // 4 字节数组（big-endian）
  byteString: string;               // 字节序列空格分隔（如 "00 01 01 10"）
} {
  const {
    protocolType = 0,
    protocolVersion = 1,
    rs485Flag = 0,
    uploadFlag = 0,
    messageCategory,
    messageId,
  } = params;

  // 保留位固定为 0，无需参数

  // 计算 32 位整数
  const value =
    (protocolType << 24) |
    (protocolVersion << 16) |
    (rs485Flag << 13) |
    (uploadFlag << 12) |
    (messageCategory << 8) |
    messageId;

  // 转为 8 位十六进制字符串（补零）
  const hex = value.toString(16).toUpperCase().padStart(8, '0');

  // 转为 big-endian 字节数组
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value, false); // false 表示 big-endian

  // 字节序列字符串（常用于调试或日志）
  const byteString = Array.from(bytes)
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

  return { value, hex, bytes, byteString };
}

/* ======================== 使用示例 ======================== */

// 示例1：读取读写器参数指令（配置与管理消息，MID=0x10）
const result1 = generateControlWord({
  messageCategory: 1,   // 配置与管理消息
  messageId: 0x10,
  // 其他使用默认值：protocolType=0, version=1, rs485=0, upload=0
});

console.log('示例1 - 读取读写器参数');
console.log('32位整数:', result1.value);          // 65744
console.log('十六进制:', result1.hex);            // 00010110
console.log('字节数组:', result1.bytes);          // Uint8Array [0, 1, 1, 16]
console.log('字节序列:', result1.byteString);     // 00 01 01 10

// 示例2：读写器主动上传标签数据（RFID 配置与操作消息，假设 MID=0x01，主动上传=1）
const result2 = generateControlWord({
  uploadFlag: 1,
  messageCategory: 2,
  messageId: 0x01,
});

console.log('\n示例2 - 主动上传标签数据');
console.log('十六进制:', result2.hex);            // 00011201
console.log('字节序列:', result2.byteString);     // 00 01 12 01

// 示例3：自定义（天线集线器协议，RS485=1）
const result3 = generateControlWord({
  protocolType: 15,     // 天线集线器控制协议
  rs485Flag: 1,
  messageCategory: 0,
  messageId: 0xFF,
});

console.log('\n示例3 - 自定义');
console.log('字节序列:', result3.byteString);     // 0F 01 20 FF
