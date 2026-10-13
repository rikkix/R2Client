'use client';

import { Spin } from 'antd';

export default function FileAreaLoading({ searching = false }: { searching?: boolean }) {
  const description = searching ? 'Searching bucket...' : 'Loading folder...';
  return (
    <div role="status" aria-label={description}>
      <Spin delay={150} description={description}>
        <div className="file-list-loading" />
      </Spin>
    </div>
  );
}
