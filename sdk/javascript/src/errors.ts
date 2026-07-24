export class R2RpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'R2RpcError';
  }
}

export class R2RpcHttpError extends R2RpcError {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'R2RpcHttpError';
  }
}

export class R2RpcAuthenticationError extends R2RpcError {
  constructor(message = '设备令牌鉴权失败') {
    super(message);
    this.name = 'R2RpcAuthenticationError';
  }
}
