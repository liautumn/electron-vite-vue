/**
 * 接口返回
 */
export interface ApiResponse<T = any> {
  code: number
  msg: string
  data: T
}

/**
 * code 枚举
 */
export enum ApiCode {
  SUCCESS = 200,
  ERROR = 500,
  UNAUTHORIZED = 401,
}

/**
 * 通用分页参数
 */
export interface PageParams {
    pageNum: number
    pageSize: number
}

/**
 * 通用分页返回
 */
export interface PageResult<T> {
    list: T[]
    total: number
}

/* =========================
 * 登录相关
 * ========================= */

export interface LoginParams {
    username: string
    password: string
}

export interface LoginResult {
    token: string
    name: string
}

/**
 * 上传文件返回
 */
export interface UploadResult {
    url: string
}
