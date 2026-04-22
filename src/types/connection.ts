export type TransportConnectionMode = 'serial' | 'tcp'

export type BaseTransportConnectionProfile = {
  id: string
  name: string
  sessionId: number
}

export type SerialTransportConnectionProfile = BaseTransportConnectionProfile & {
  mode: 'serial'
  portPath: string
  baudRate: number
}

export type TcpTransportConnectionProfile = BaseTransportConnectionProfile & {
  mode: 'tcp'
  host: string
  port: number
}

export type TransportConnectionProfile =
  | SerialTransportConnectionProfile
  | TcpTransportConnectionProfile
