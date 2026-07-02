import { reportsHandlers } from './reports';
import { modelsHandlers } from './models';
import { usersHandlers } from './users';
import { historyHandlers } from './history';
import { signalsHandlers } from './signals';
import { trainingHandlers } from './training';

export const handlers = [
  ...reportsHandlers,
  ...modelsHandlers,
  ...usersHandlers,
  ...historyHandlers,
  ...signalsHandlers,
  ...trainingHandlers,
];
