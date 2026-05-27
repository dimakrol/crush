import { IBaseRepository } from '../../shared/repositories/base.repository'
import { User, CreateUserData } from './user.types'

export const USER_REPOSITORY = 'USER_REPOSITORY'

export interface IUserRepository extends IBaseRepository<User> {
  findByEmail(email: string): Promise<User | null>
  create(data: CreateUserData): Promise<User>
}
