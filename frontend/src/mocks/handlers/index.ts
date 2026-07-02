import { reportsHandlers } from './reports';
import { modelsHandlers } from './models';
import { usersHandlers } from './users';

export const handlers = [...reportsHandlers, ...modelsHandlers, ...usersHandlers];
