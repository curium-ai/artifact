import { useState } from 'react';
import { Modal, Input, Button } from './ui';

interface NewFolderModalProps {
  onClose: () => void;
  onCreate: (name: string) => void;
}

export function NewFolderModal({ onClose, onCreate }: NewFolderModalProps) {
  const [name, setName] = useState('');

  const handleCreate = () => {
    if (name.trim()) {
      onCreate(name.trim());
      onClose();
    }
  };

  return (
    <Modal title="Create new folder" onClose={onClose} width={380}>
      <div style={{ marginBottom: 16 }}>
        <Input
          value={name}
          onChange={setName}
          placeholder="Folder name"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate} disabled={!name.trim()}>Create</Button>
      </div>
    </Modal>
  );
}
