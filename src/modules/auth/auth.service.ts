import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Admin } from '../admins/admin.entity';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const BCRYPT_ROUNDS = 10;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Admin) private readonly adminsRepo: Repository<Admin>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const admin = await this.adminsRepo.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    // Same 401 for unknown email and wrong password — no account enumeration.
    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!admin.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    admin.lastLoginAt = new Date();
    const tokens = await this.issueTokens(admin);
    await this.adminsRepo.save(admin);

    return {
      ...tokens,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: {
          id: admin.role.id,
          name: admin.role.name,
          permissions: admin.role.permissions,
        },
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const admin = await this.adminsRepo.findOne({ where: { id: payload.sub } });
    // No stored hash (logged out) or a rotated-out/forged token → 401.
    if (
      !admin ||
      !admin.refreshTokenHash ||
      !(await bcrypt.compare(refreshToken, admin.refreshTokenHash))
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!admin.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }

    const tokens = await this.issueTokens(admin);
    await this.adminsRepo.save(admin);
    return tokens;
  }

  async logout(adminId: string): Promise<void> {
    await this.adminsRepo.update({ id: adminId }, { refreshTokenHash: null });
  }

  async updateProfile(admin: Admin, dto: UpdateProfileDto): Promise<Admin> {
    if (dto.email) {
      const email = dto.email.toLowerCase();
      if (email !== admin.email) {
        const existing = await this.adminsRepo.findOne({ where: { email } });
        if (existing) throw new ConflictException('Email already in use');
      }
      admin.email = email;
    }
    if (dto.name) admin.name = dto.name;
    return this.adminsRepo.save(admin);
  }

  async changePassword(admin: Admin, dto: ChangePasswordDto): Promise<void> {
    const valid = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }
    admin.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // Invalidate every other session.
    admin.refreshTokenHash = null;
    await this.adminsRepo.save(admin);
  }

  /**
   * Issues a new access/refresh pair and stores the bcrypt hash of the new
   * refresh token on the admin (rotation) — the caller saves the entity.
   */
  private async issueTokens(admin: Admin): Promise<TokenPair> {
    const payload = { sub: admin.id };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES', '7d'),
      }),
    ]);
    admin.refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
    return { accessToken, refreshToken };
  }
}
