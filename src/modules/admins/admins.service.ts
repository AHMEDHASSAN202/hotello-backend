import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { Role } from '../roles/role.entity';
import { Admin } from './admin.entity';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AdminsService {
  constructor(
    @InjectRepository(Admin) private readonly adminsRepo: Repository<Admin>,
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
  ) {}

  async findAll(query: ListAdminsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const base: FindOptionsWhere<Admin> = {};
    if (query.roleId) base.roleId = query.roleId;

    const where = query.search
      ? [
          { ...base, name: ILike(`%${query.search}%`) },
          { ...base, email: ILike(`%${query.search}%`) },
        ]
      : base;

    const [data, total] = await this.adminsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<Admin> {
    const admin = await this.adminsRepo.findOne({ where: { id } });
    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  async create(dto: CreateAdminDto): Promise<Admin> {
    const email = dto.email.toLowerCase();
    await this.assertEmailAvailable(email);
    const role = await this.rolesRepo.findOne({ where: { id: dto.roleId } });
    if (!role) throw new NotFoundException('Role not found');

    const admin = this.adminsRepo.create({
      name: dto.name,
      email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      roleId: dto.roleId,
      role,
      isActive: true,
    });
    return this.adminsRepo.save(admin);
  }

  async update(id: string, dto: UpdateAdminDto): Promise<Admin> {
    const admin = await this.findOne(id);

    if (dto.email) {
      const email = dto.email.toLowerCase();
      if (email !== admin.email) await this.assertEmailAvailable(email);
      admin.email = email;
    }
    if (dto.roleId && dto.roleId !== admin.roleId) {
      const role = await this.rolesRepo.findOne({ where: { id: dto.roleId } });
      if (!role) throw new NotFoundException('Role not found');
      admin.roleId = dto.roleId;
      admin.role = role;
    }
    if (dto.name) admin.name = dto.name;
    if (dto.password) {
      admin.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      // Force re-login everywhere after a password reset.
      admin.refreshTokenHash = null;
    }
    return this.adminsRepo.save(admin);
  }

  async updateStatus(
    id: string,
    isActive: boolean,
    currentAdminId: string,
  ): Promise<Admin> {
    if (id === currentAdminId && !isActive) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const admin = await this.findOne(id);
    admin.isActive = isActive;
    if (!isActive) admin.refreshTokenHash = null;
    return this.adminsRepo.save(admin);
  }

  async remove(id: string, currentAdminId: string): Promise<void> {
    if (id === currentAdminId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const admin = await this.findOne(id);
    await this.adminsRepo.remove(admin);
  }

  private async assertEmailAvailable(email: string) {
    const existing = await this.adminsRepo.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already in use');
  }
}
