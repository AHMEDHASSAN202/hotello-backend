import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Admin } from '../admins/admin.entity';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentAdmin() admin: Admin) {
    return this.authService.logout(admin.id);
  }

  @Get('me')
  me(@CurrentAdmin() admin: Admin) {
    return admin;
  }

  @Patch('profile')
  updateProfile(@CurrentAdmin() admin: Admin, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(admin, dto);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(@CurrentAdmin() admin: Admin, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(admin, dto);
  }
}
