import { Injectable, OnModuleInit } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { getDb } from '../../config/database'
import { IUserRepository } from './user.repository.interface'
import { User, CreateUserData } from './user.types'

@Injectable()
export class MongoUserRepository implements IUserRepository, OnModuleInit {
  async onModuleInit() {
    await getDb().collection('users').createIndex({ email: 1 }, { unique: true })
  }

  async findById(id: string): Promise<User | null> {
    const doc = await getDb().collection('users').findOne({ _id: new ObjectId(id) })
    return doc ? this.toUser(doc) : null
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await getDb().collection('users').findOne({ email })
    return doc ? this.toUser(doc) : null
  }

  async create(data: CreateUserData): Promise<User> {
    const now = new Date()
    const result = await getDb().collection('users').insertOne({ ...data, createdAt: now, updatedAt: now })
    return { id: result.insertedId.toHexString(), ...data, createdAt: now, updatedAt: now }
  }

  private toUser(doc: Record<string, unknown>): User {
    return {
      id: (doc._id as ObjectId).toHexString(),
      email: doc.email as string,
      passwordHash: doc.passwordHash as string,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    }
  }
}
