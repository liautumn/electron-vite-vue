import request from "../utils/request";

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  token: string
  name: string
}

export function login(data: LoginParams) {
  return request<LoginResult>({
    url: '/login',
    method: 'post',
    data,
  })
}
