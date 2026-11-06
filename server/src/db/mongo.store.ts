import { MongoClient, MongoServerError, type Collection, type Db, type Document } from 'mongodb'
import type { BaseDoc } from '@growth-os/contracts'
import { COLLECTIONS, DuplicateIdError, Store, type CollectionName, type Filter, type Repository } from './store'

const NO_MONGO_ID = { projection: { _id: 0 } } as const

class MongoRepository<T extends BaseDoc> implements Repository<T> {
  constructor(private readonly c: Collection<Document>) {}

  async list(filter: Filter = {}) {
    return (await this.c.find(filter, NO_MONGO_ID).sort({ id: 1 }).toArray()) as unknown as T[]
  }
  async get(id: string) {
    return (await this.c.findOne({ id }, NO_MONGO_ID)) as unknown as T | null
  }
  async insert(doc: T) {
    try {
      await this.c.insertOne({ ...doc })
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) throw new DuplicateIdError(doc.id)
      throw e
    }
    return doc
  }
  async replace(doc: T) {
    const r = await this.c.replaceOne({ id: doc.id }, { ...doc })
    return r.matchedCount ? doc : null
  }
  async remove(id: string) {
    return (await this.c.deleteOne({ id })).deletedCount === 1
  }
}

export class MongoStore extends Store {
  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
  ) {
    super()
  }

  static async connect(url: string, dbName: string): Promise<MongoStore> {
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 10_000 })
    await client.connect()
    const db = client.db(dbName)
    await Promise.all(COLLECTIONS.map((name) => db.collection(name).createIndex({ id: 1 }, { unique: true })))
    return new MongoStore(client, db)
  }

  collection<T extends BaseDoc>(name: CollectionName): Repository<T> {
    return new MongoRepository<T>(this.db.collection(name))
  }

  async ping() {
    try {
      await this.db.command({ ping: 1 })
      return true
    } catch {
      return false
    }
  }

  close() {
    return this.client.close()
  }
}
