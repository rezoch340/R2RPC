import { Module } from '@nestjs/common';
import { AdministratorAccountPolicyService } from './administrator-account-policy.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [AdministratorAccountPolicyService, UsersService],
  exports: [AdministratorAccountPolicyService, UsersService],
})
export class UsersModule {}
