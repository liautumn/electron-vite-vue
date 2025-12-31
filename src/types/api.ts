export interface ApiResponse<T = any> {
  code: number
  msg: string
  data: T
}

export enum ApiCode {
  SUCCESS = 200,
  UNAUTHORIZED = 401,
}
