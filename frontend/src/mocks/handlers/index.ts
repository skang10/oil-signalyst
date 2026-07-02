import { reportsHandlers } from './reports';
import { modelsHandlers } from './models';
import { usersHandlers } from './users';
import { historyHandlers } from './history';

export const handlers = [...reportsHandlers, ...modelsHandlers, ...usersHandlers, ...historyHandlers];
