import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';

export default function ModalCloudscape() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [created, setCreated] = useState<string[]>([]);
	const submit = () => {
		if (!name.trim()) return;
		setCreated((c) => [...c, name.trim()]);
		setName('');
		setOpen(false);
	};
	return (
		<SpaceBetween size="m">
			<Button variant="primary" onClick={() => setOpen(true)}>
				Create resource
			</Button>
			<Modal
				visible={open}
				onDismiss={() => setOpen(false)}
				header="Create resource"
				footer={
					<Box float="right">
						<SpaceBetween direction="horizontal" size="xs">
							<Button variant="link" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button variant="primary" disabled={!name.trim()} onClick={submit}>
								Create
							</Button>
						</SpaceBetween>
					</Box>
				}
			>
				<FormField label="Resource name">
					<Input
						value={name}
						onChange={({ detail }) => setName(detail.value)}
						placeholder="my-resource"
					/>
				</FormField>
			</Modal>
			{created.length > 0 && <Box>Created: {created.join(', ')}</Box>}
		</SpaceBetween>
	);
}
