import { ArgumentsHost, BadRequestException, Catch, type ExceptionFilter } from "@nestjs/common";
import { ZodError } from "zod";

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter<ZodError> {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const error = new BadRequestException({ message: "请求参数无效", issues: exception.issues });
    response.status(error.getStatus()).json(error.getResponse());
  }
}
