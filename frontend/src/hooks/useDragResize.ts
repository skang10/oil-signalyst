import { useRef, useState } from 'react';

const MIN_WIDTH = 280;
const MAX_WIDTH = 780;

export function useDragResize(initialWidth = 360) {
  const [width, setWidth] = useState(initialWidth);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  function onMouseDown(e: React.MouseEvent) {
    startX.current = e.clientX;
    startWidth.current = width;
    setDragging(true);

    function onMove(ev: MouseEvent) {
      const dx = startX.current - ev.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + dx)));
    }
    function onUp() {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  return { width, setWidth, dragging, onMouseDown };
}
