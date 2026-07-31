import { PartialType } from '@nestjs/mapped-types';
import { CreateTenantRoleDto } from './create-tenant-role.dto';

export class UpdateTenantRoleDto extends PartialType(CreateTenantRoleDto) {}
