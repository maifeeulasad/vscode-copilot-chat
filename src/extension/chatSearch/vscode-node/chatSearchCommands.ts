/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable, DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';

export class ChatSearchCommands extends Disposable implements IExtensionContribution {
	readonly id = 'chatSearchCommands';
	private _disposables = new DisposableStore();

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();
		this._registerCommands();
	}

	private _registerCommands(): void {
		// Open chat search
		this._disposables.add(
			vscode.commands.registerCommand('github.copilot.chat.search.find', async () => {
				await vscode.commands.executeCommand('copilot-chat.focus');
				await vscode.commands.executeCommand('list.find');
				this.telemetryService.sendMSFTTelemetryEvent('chat.search.opened');
			})
		);

		// Search next
		this._disposables.add(
			vscode.commands.registerCommand('github.copilot.chat.search.next', async () => {
				await vscode.commands.executeCommand('list.findNext');
				this.telemetryService.sendMSFTTelemetryEvent('chat.search.next');
			})
		);

		// Search previous
		this._disposables.add(
			vscode.commands.registerCommand('github.copilot.chat.search.previous', async () => {
				await vscode.commands.executeCommand('list.findPrevious');
				this.telemetryService.sendMSFTTelemetryEvent('chat.search.previous');
			})
		);

		// Close search
		this._disposables.add(
			vscode.commands.registerCommand('github.copilot.chat.search.close', async () => {
				await vscode.commands.executeCommand('list.closeFind');
				this.telemetryService.sendMSFTTelemetryEvent('chat.search.closed');
			})
		);

	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}
}
