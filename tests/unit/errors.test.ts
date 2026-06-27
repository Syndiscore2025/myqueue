import {
  ApplicationError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  PaymentRequiredError,
  UnauthorizedError,
  ValidationError,
  isApplicationError,
} from '../../src/domain/errors';

describe('application errors', () => {
  it('maps each error to the correct status code and code', () => {
    expect(new ValidationError('x')).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(new UnauthorizedError('x')).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    expect(new PaymentRequiredError('x')).toMatchObject({
      statusCode: 402,
      code: 'PLAN_LIMIT_EXCEEDED',
    });
    expect(new ForbiddenError('x')).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(new NotFoundError('x')).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(new ConflictError('x')).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(new InternalServerError()).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('defaults operational errors to operational and 500s to non-operational', () => {
    expect(new ValidationError('x').isOperational).toBe(true);
    expect(new InternalServerError().isOperational).toBe(false);
  });

  it('carries structured details and a cause', () => {
    const cause = new Error('root');
    const error = new ValidationError('bad', { details: { field: 'name' }, cause });
    expect(error.details).toEqual({ field: 'name' });
    expect(error.cause).toBe(cause);
  });

  it('is recognised by the type guard and extends Error', () => {
    const error = new NotFoundError('missing');
    expect(isApplicationError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotFoundError');
    expect(isApplicationError(new Error('plain'))).toBe(false);
  });
});
