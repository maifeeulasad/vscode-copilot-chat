/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../../../util/vs/platform/instantiation/common/descriptors';
import { ChatSearchCommands } from './chatSearchCommands';

/**
 * Chat Search contributions
 * Note: ChatSearchService is registered in services.ts
 * ChatSearchCommands is registered as a contribution in contributions.ts
 */
export const chatSearchContributions = [
	new SyncDescriptor(ChatSearchCommands),
] as const;

