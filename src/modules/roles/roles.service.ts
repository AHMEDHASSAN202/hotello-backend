import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from './permissions.constants';
import { Role } from './role.entity';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(Admin) private readonly adminsRepo: Repository<Admin>,
  ) {}

  getCatalog(): Record<string, string[]> {
    return PERMISSION_CATALOG;
  }

  async findAll() {
    const roles = await this.rolesRepo.find({ order: { createdAt: 'ASC' } });
    return Promise.all(
      roles.map(async (role) => ({
        ...role,
        adminsCount: await this.adminsRepo.count({ where: { roleId: role.id } }),
      })),
    );
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    this.assertKnownPermissions(dto.permissions);
    await this.assertNameAvailable(dto.name);
    const role = this.rolesRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      permissions: dto.permissions,
      isSystem: false,
    });
    return this.rolesRepo.save(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.rolesRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot be modified');
    }
    if (dto.permissions) this.assertKnownPermissions(dto.permissions);
    if (dto.name && dto.name.toLowerCase() !== role.name.toLowerCase()) {
      await this.assertNameAvailable(dto.name, id);
    }
    Object.assign(role, dto);
    return this.rolesRepo.save(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.rolesRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot be deleted');
    }
    const inUse = await this.adminsRepo.count({ where: { roleId: id } });
    if (inUse > 0) {
      throw new ConflictException(`Role is assigned to ${inUse} admin(s)`);
    }
    await this.rolesRepo.remove(role);
  }

  private assertKnownPermissions(permissions: string[]) {
    const invalid = permissions.filter(
      (key) => !ALL_PERMISSION_KEYS.includes(key),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Unknown permission keys: ${invalid.join(', ')}`,
      );
    }
  }

  private async assertNameAvailable(name: string, excludeId?: string) {
    const existing = await this.rolesRepo.findOne({
      where: excludeId
        ? { name: ILike(name), id: Not(excludeId) }
        : { name: ILike(name) },
    });
    if (existing) throw new ConflictException('Role name already in use');
  }
}
