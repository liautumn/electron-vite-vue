export type MenuItem = {
  routeName: string
  label: string
  children?: MenuItem[]
}

export const menuItems: MenuItem[] = [
  {
    routeName: 'home',
    label: '首页',
  },
  {
    routeName: 'demos',
    label: '示例合集',
    children: [
      {routeName: 'rs232-tcp-demo', label: 'RS232/TCP 通讯'},
      {routeName: 'mqtt-demo', label: 'MQTT Demo'},
      {routeName: 'sqlite-demo', label: 'SQLite CRUD Demo'},
      {routeName: 'sensevoice-demo', label: 'SenseVoice 语音识别'},
      {routeName: 'guoxin-rfid-demo', label: '国芯 RFID 测试'},
      {routeName: 'lock-demo', label: 'Lock 锁控板 测试'},
      {routeName: 'led-demo', label: 'LED 指示灯控制'},
      {routeName: 'yolo26-demo', label: 'YOLO26 ONNX 测试'},
    ],
  },
]
