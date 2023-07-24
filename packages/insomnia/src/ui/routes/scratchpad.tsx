import React, {  } from 'react';
import { LoaderFunction, redirect } from 'react-router-dom';

import { getCurrentSessionId } from '../../account/session';
import ScratchPad from './scratchpad-comp';

export const loader: LoaderFunction = async () => {
  const sessionId = getCurrentSessionId();
  if (sessionId) {
    throw redirect('organization');
  }

  return null;
};

const ScratchPadRoute = () => {
  return (
    <ScratchPad />
  );
};

export default ScratchPadRoute;
