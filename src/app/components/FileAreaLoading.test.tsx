import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import FileAreaLoading from './FileAreaLoading';

test('folder and search loading stay inside the file area without a fullscreen mask', () => {
  for (const searching of [false, true]) {
    const markup = renderToStaticMarkup(<FileAreaLoading searching={searching} />);
    expect(markup).not.toContain('ant-spin-fullscreen');
    expect(markup).toContain('file-list-loading');
    expect(markup).toContain(searching ? 'Searching bucket...' : 'Loading folder...');
    expect(markup).toContain('role="status"');
  }
});
