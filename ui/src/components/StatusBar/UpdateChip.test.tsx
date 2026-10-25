// The update chip at the right of the status bar: one state per update status, a progress bar while downloading,
// "Restart to update" that restarts, and a click elsewhere that opens Settings › Updates.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../../platform';
import type { DbStudioBridge, UpdateStatus } from '../../platform/bridge';
import { createElectronPlatform } from '../../platform/electron';
import { useUi } from '../../store/ui';
import { useUpdates } from '../../store/updates';
import { useSettingsNav } from '../layout/settings/nav';
import { UpdateChip } from './UpdateChip';

const status = (s: Partial<UpdateStatus>): UpdateStatus => ({ state: 'idle', mode: 'install', currentVersion: '1.0.0', ...s });

function bridge(over: Partial<DbStudioBridge> = {}): DbStudioBridge {
  return {
    platform: 'electron', appVersion: '1.0.0',
    getEngineInfo: async () => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }),
    showSaveDialog: async () => null, showOpenDialog: async () => null, readTextFile: async () => '', writeTextFile: async () => undefined,
    openExternal: async () => undefined, onMenuCommand: () => () => undefined, onEngineRestarted: () => () => undefined,
    loadWorkspace: async () => null, saveWorkspace: async () => undefined, setTitle: () => undefined,
    quitAndInstall: vi.fn(async () => true),
    ...over,
  };
}

beforeEach(() => {
  useUpdates.setState({ status: null, dismissed: null });
  useUi.setState({ settingsOpen: false });
  useSettingsNav.setState({ section: 'general' });
});
afterEach(() => setPlatform(null));

describe('status bar update chip', () => {
  it('stays hidden when there is nothing to say', () => {
    const { container } = render(<UpdateChip />);
    for (const s of [null, status({}), status({ state: 'up-to-date' }), status({ state: 'disabled', mode: 'disabled' })]) {
      act(() => useUpdates.setState({ status: s }));
      expect(container).toBeEmptyDOMElement();
    }
  });

  it('shows checking, available and download progress; a click opens Settings › Updates', () => {
    render(<UpdateChip />);
    act(() => useUpdates.setState({ status: status({ state: 'checking' }) }));
    expect(screen.getByRole('button')).toHaveTextContent('Checking for updates…');
    act(() => useUpdates.setState({ status: status({ state: 'available', version: '1.1.0' }) }));
    expect(screen.getByRole('button')).toHaveTextContent('v1.1.0 available');
    act(() => useUpdates.setState({ status: status({ state: 'downloading', version: '1.1.0', percent: 42.4 }) }));
    expect(screen.getByRole('button')).toHaveTextContent('Downloading 42%');
    expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '42');
    fireEvent.click(screen.getByRole('button'));
    expect(useUi.getState().settingsOpen).toBe(true);
    expect(useSettingsNav.getState().section).toBe('updates');
  });

  it('"Restart to update" restarts and installs', async () => {
    const b = bridge();
    setPlatform(createElectronPlatform(b));
    render(<UpdateChip />);
    act(() => useUpdates.setState({ status: status({ state: 'ready', version: '1.1.0' }) }));
    const chip = screen.getByRole('button', { name: 'Restart to update to Rowlit 1.1.0' });
    expect(chip).toHaveTextContent('Restart to update');
    fireEvent.click(chip);
    await act(async () => undefined);
    expect(b.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(useUi.getState().settingsOpen).toBe(false);
  });

  it('while downloading (desktop) a stop control cancels the download; the chip then reads "Download stopped"', async () => {
    const getUpdateStatus = vi.fn(async () => status({ state: 'available', version: '1.1.0', downloadStopped: true }));
    const b = bridge({ cancelUpdateDownload: vi.fn(async () => true), getUpdateStatus });
    setPlatform(createElectronPlatform(b));
    render(<UpdateChip />);
    act(() => useUpdates.setState({ status: status({ state: 'downloading', version: '1.1.0', percent: 12 }) }));
    const stop = screen.getByRole('button', { name: 'Stop download' });
    expect(stop).toHaveAttribute('title', 'Stop download');
    fireEvent.click(stop);
    await act(async () => undefined);
    expect(b.cancelUpdateDownload).toHaveBeenCalledTimes(1);
    expect(useUi.getState().settingsOpen).toBe(false);
    expect(useUpdates.getState().status).toMatchObject({ state: 'available', downloadStopped: true });
    expect(screen.queryByRole('button', { name: 'Stop download' })).toBeNull();
    expect(screen.getByRole('button')).toHaveTextContent('Download stopped');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('has no stop control without the bridge method (older preload, browser) or when not downloading', () => {
    render(<UpdateChip />);
    act(() => useUpdates.setState({ status: status({ state: 'downloading', version: '1.1.0', percent: 12 }) }));
    expect(screen.queryByRole('button', { name: 'Stop download' })).toBeNull();
    setPlatform(createElectronPlatform(bridge({ cancelUpdateDownload: vi.fn(async () => true) })));
    for (const s of [status({ state: 'available', version: '1.1.0' }), status({ state: 'ready', version: '1.1.0' }), status({ state: 'checking' })]) {
      act(() => useUpdates.setState({ status: s }));
      expect(screen.queryByRole('button', { name: 'Stop download' })).toBeNull();
    }
  });

  it('a failed check is a quiet mark without a label', () => {
    render(<UpdateChip />);
    act(() => useUpdates.setState({ status: status({ state: 'error', message: 'offline' }) }));
    const chip = screen.getByRole('button', { name: 'Update check failed — update settings' });
    expect(chip).toHaveTextContent('');
    expect(chip.title).toMatch(/offline/);
  });
});
