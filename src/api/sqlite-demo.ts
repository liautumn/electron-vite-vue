import {
  DemoUser,
  type DemoUserCreateInput,
  type DemoUserRow,
  type DemoUserUpdateInput,
} from '../entities/demo-user'

export interface DemoUserPageQuery {
  page: number
  pageSize: number
  keyword?: string
}

export interface DemoUserPageResult {
  list: DemoUser[]
  total: number
}

export async function queryDemoUsersPage(query: DemoUserPageQuery): Promise<DemoUserPageResult> {
  const page = Number.isFinite(query.page) && query.page > 0 ? Math.floor(query.page) : 1
  const pageSize =
    Number.isFinite(query.pageSize) && query.pageSize > 0 ? Math.floor(query.pageSize) : 10
  const offset = (page - 1) * pageSize
  const keyword = query.keyword?.trim() ?? ''
  const whereSql = keyword ? `WHERE name LIKE ? OR email LIKE ?` : ''
  const whereParams = keyword ? [`%${keyword}%`, `%${keyword}%`] : []

  const totalSql = `
    SELECT COUNT(1) AS total
    FROM demo_users
    ${whereSql}
  `

  const totalResult = await window.sqlite.execute<{total: number}>({
    sql: totalSql,
    params: whereParams,
  })

  const total = Number(totalResult.rows[0]?.total ?? 0)

  const listSql = `
    SELECT id, name, age, email, created_at, updated_at
    FROM demo_users
    ${whereSql}
    ORDER BY id DESC
    LIMIT ?
    OFFSET ?
  `

  const listResult = await window.sqlite.execute<DemoUserRow>({
    sql: listSql,
    params: [...whereParams, pageSize, offset],
  })

  return {
    total,
    list: listResult.rows.map((row: DemoUserRow) => DemoUser.fromRow(row)),
  }
}

export async function queryDemoUserById(id: number) {
  const sql = `
    SELECT id, name, age, email, created_at, updated_at
    FROM demo_users
    WHERE id = ?
    LIMIT 1
  `

  const result = await window.sqlite.execute<DemoUserRow>({
    sql,
    params: [id],
  })
  const row = result.rows[0]
  return row ? DemoUser.fromRow(row) : null
}

export async function createDemoUser(input: DemoUserCreateInput) {
  const sql = `
    INSERT INTO demo_users (name, age, email, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `

  const result = await window.sqlite.execute({
    sql,
    params: [input.name, input.age, input.email],
  })
  return result.lastInsertRowid
}

export async function updateDemoUser(input: DemoUserUpdateInput) {
  const sql = `
    UPDATE demo_users
    SET name = ?, age = ?, email = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `

  const result = await window.sqlite.execute({
    sql,
    params: [input.name, input.age, input.email, input.id],
  })
  return result.changes > 0
}

export async function deleteDemoUser(id: number) {
  const sql = `DELETE FROM demo_users WHERE id = ?`
  const result = await window.sqlite.execute({
    sql,
    params: [id],
  })
  return result.changes > 0
}
