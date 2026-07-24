export class Rer0RpcError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'Rer0RpcError';
  }
}

export class Rer0RpcHttpError extends Rer0RpcError {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'Rer0RpcHttpError';
  }
}

export class Rer0RpcAuthenticationError extends Rer0RpcError {
  constructor(message = '设备令牌鉴权失败') {
    super(message);
    this.name = 'Rer0RpcAuthenticationError';
  }
}
