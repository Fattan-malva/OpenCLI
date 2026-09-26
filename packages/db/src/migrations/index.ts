import { migration001 } from './001-initial.js';
import { migration002 } from './002-settings.js';
import { migration003 } from './003-model-routing.js';
import { migration004 } from './004-workflows.js';
import { migration005 } from './005-workflow-events.js';
import { migration006 } from './006-task-capabilities.js';
import { migration007 } from './007-chat.js';
import { migration008 } from './008-chat-message-meta.js';
import { migration009 } from './009-chat-broadcast.js';
import { migration010 } from './010-chat-routing.js';
import { migration011 } from './011-routing-spec.js';

export const migrations = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011];
