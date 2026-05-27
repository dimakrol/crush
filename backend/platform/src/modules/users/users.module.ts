import { Module } from '@nestjs/common'
import { MongoUserRepository } from './user.repository.mongo'
import { USER_REPOSITORY } from './user.repository.interface'

@Module({
  providers: [{ provide: USER_REPOSITORY, useClass: MongoUserRepository }],
  exports: [USER_REPOSITORY],
})
export class UsersModule {}
