import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { count } from 'drizzle-orm';
import { Response } from 'express';
import { z } from 'zod';
import { getSqlite } from '../../config/sqlite';
import { ROLES, users } from '../../drizzle/admin.schema';
import { CurrentUser, Roles } from '../../shared/auth/auth.decorators';
import { SessionUser } from '../../shared/auth/session';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import {
  contentRange,
  enumFilter,
  ListSpec,
  parseListQuery,
  stringFilter,
} from '../../shared/ra/list-query';
import { PUBLIC_COLUMNS, UsersService } from './users.service';

const SPEC: ListSpec = {
  resource: 'users',
  sortable: {
    id: users.id,
    username: users.username,
    role: users.role,
    createdAt: users.createdAt,
  },
  defaultSort: { field: 'username', order: 'ASC' },
  filters: {
    id: stringFilter(users.id, 'id'),
    username: stringFilter(users.username, 'username'),
    role: enumFilter(users.role, 'role', ROLES),
  },
};

// 8 characters is not much, but it is more than the bootstrap `admin/admin`
// that this API is meant to replace on day one.
const passwordSchema = z.string().min(8, 'must be at least 8 characters');

const createSchema = z.object({
  username: z.string().min(3).max(64),
  password: passwordSchema,
  role: z.enum(ROLES),
});

// Partial, and password optional: react-admin PUTs the whole record back, and
// the edit form only carries a password when one was actually typed.
const updateSchema = z.object({
  username: z.string().min(3).max(64).optional(),
  password: passwordSchema.optional(),
  role: z.enum(ROLES).optional(),
});

@Controller('api/users')
@Roles('admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { where, orderBy, start, limit } = parseListQuery(query, SPEC);
    const db = getSqlite();

    const [{ value: total }] = db
      .select({ value: count() })
      .from(users)
      .where(where)
      .all();
    const rows = db
      .select(PUBLIC_COLUMNS)
      .from(users)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(start)
      .all();

    res.setHeader(
      'Content-Range',
      contentRange(SPEC.resource, start, rows.length, total),
    );
    return { data: rows };
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return { data: this.usersService.find(id) };
  }

  // Pipes are attached to @Body, not with @UsePipes: a method-scoped pipe runs
  // against every parameter, so on a route that also takes @Param('id') the
  // object schema would be handed a bare id string and reject it.
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSchema))
    body: z.infer<typeof createSchema>,
  ) {
    return { data: await this.usersService.create(body) };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema))
    body: z.infer<typeof updateSchema>,
  ) {
    return { data: await this.usersService.update(id, body) };
  }

  // Returns the deleted record: react-admin keeps it for the undo notification.
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: SessionUser) {
    return { data: this.usersService.remove(id, actor.id) };
  }
}
