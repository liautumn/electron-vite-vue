export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue
    }

export interface JsonReadRequest<T = JsonValue> {
  fileName: string
  fallback?: T
}

export interface JsonWriteRequest<T = JsonValue> {
  fileName: string
  data: T
  pretty?: boolean
}

export interface JsonMethods {
  read<T = JsonValue>(request: JsonReadRequest<T>): Promise<T | null>

  write<T = JsonValue>(request: JsonWriteRequest<T>): Promise<boolean>

  getDirectory(): Promise<string>
}
