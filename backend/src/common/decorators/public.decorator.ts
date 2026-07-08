import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
// 标注接口无需 JWT(如登录、手机端登录)
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
