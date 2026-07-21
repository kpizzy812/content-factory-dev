declare module "#auth-utils" {
  interface User {
    id: number
    externalId: number
    email: string
    name: string | null
    surname: string | null
    rolePreset: string
  }
}

export {}
