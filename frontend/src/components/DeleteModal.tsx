import { Modal, Button } from './ui';

interface DeleteModalProps {
  itemName: string;
  itemType: 'file' | 'folder';
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteModal({ itemName, itemType, onClose, onConfirm }: DeleteModalProps) {
  return (
    <Modal title={`Delete ${itemType}`} onClose={onClose} width={380}>
      <p className="modal__desc">
        Are you sure you want to delete <strong>{itemName}</strong>? This cannot be undone.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => { onConfirm(); onClose(); }}>Delete</Button>
      </div>
    </Modal>
  );
}
