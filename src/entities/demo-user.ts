export interface DemoUserRow {
  id: number
  name: string
  age: number
  email: string
  created_at: string
  updated_at: string
}

export interface DemoUserPayload {
  id: number
  name: string
  age: number
  email: string
  createdAt: string
  updatedAt: string
}

export interface DemoUserCreateInput {
  name: string
  age: number
  email: string
}

export interface DemoUserUpdateInput extends DemoUserCreateInput {
  id: number
}

export class DemoUser {
  id: number
  name: string
  age: number
  email: string
  createdAt: string
  updatedAt: string

  constructor(payload: DemoUserPayload) {
    this.id = payload.id
    this.name = payload.name
    this.age = payload.age
    this.email = payload.email
    this.createdAt = payload.createdAt
    this.updatedAt = payload.updatedAt
  }

  static fromRow(row: DemoUserRow) {
    return new DemoUser({
      id: Number(row.id),
      name: String(row.name),
      age: Number(row.age),
      email: String(row.email),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })
  }
}
