import request from '../utils/request'
import {LoginParams, LoginResult, PageParams, PageResult, UploadResult} from "../types/api";
import {UserInfo, UserListItem} from "../types/user";

/**
 * 登录
 */
export function login(data: LoginParams) {
    return request<LoginResult>({
        url: '/login',
        method: 'post',
        data,
    })
}

/**
 * 获取当前用户信息（GET + params）
 */
export function getUserInfo() {
    return request<UserInfo>({
        url: '/user/info',
        method: 'get',
    })
}

/**
 * 修改用户信息（PUT + data）
 */
export function updateUserInfo(data: UserInfo) {
    return request<void>({
        url: '/user/update',
        method: 'put',
        data,
    })
}

/**
 * 分页查询用户列表（GET + params）
 */
export function getUserList(params: PageParams) {
    return request<PageResult<UserListItem>>({
        url: '/user/list',
        method: 'get',
        params,
    })
}


/**
 * 根据 ID 获取用户详情
 */
export function getUserDetail(id: number) {
    return request<UserInfo>({
        url: `/user/${id}`,
        method: 'get',
    })
}

/**
 * 删除用户
 */
export function deleteUser(id: number) {
    return request<void>({
        url: `/user/${id}`,
        method: 'delete',
    })
}

/**
 * 文件上传
 */
export function uploadFile(file: File) {
    const formData = new FormData()
    formData.append('file', file)

    return request<UploadResult>({
        url: '/upload',
        method: 'post',
        data: formData,
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    })
}
