import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
@Injectable()
export class OrganizationSlugService {
  create(name: string): string {
    const base =
      name
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'organization';
    return `${base}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }
}
