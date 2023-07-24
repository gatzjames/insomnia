import React from 'react';
import {
  Outlet,
} from 'react-router-dom';

import { ErrorBoundary } from '../components/error-boundary';
import withDragDropContext from '../context/app/drag-drop-context';
import Modals from './modals';

const Root = () => {
  return (
    <>
      <ErrorBoundary>
        <div className="app">
          <Outlet />
        </div>
      </ErrorBoundary>
      <Modals />
    </>
  );
};

export default withDragDropContext(Root);
