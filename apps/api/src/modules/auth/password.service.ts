import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
@Injectable()
export class PasswordService {
  private readonly dummyHash = this.hash('unusable-dummy-' + randomUUID());
  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  async matches(password: string, passwordHash?: string): Promise<boolean> {
    const candidate = passwordHash ?? (await this.dummyHash);
    try {
      return await verify(candidate, password);
    } catch {
      return false;
    }
  }
}
