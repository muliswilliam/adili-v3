import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/** Opts a controller or route out of bearer-token authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
