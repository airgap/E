import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';

export default function LoginCloudscape() {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [submitted, setSubmitted] = useState<string | null>(null);
	const valid = email.includes('@') && password.length >= 8;
	const onSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (valid) setSubmitted(email);
	};
	return (
		<form onSubmit={onSubmit}>
			<Form
				header={<Header variant="h2">Sign in</Header>}
				actions={
					<SpaceBetween direction="horizontal" size="xs">
						<Button variant="link">Cancel</Button>
						<Button variant="primary" disabled={!valid}>
							Sign in
						</Button>
					</SpaceBetween>
				}
			>
				<Container>
					<SpaceBetween size="l">
						<FormField label="Email" description="Use the address on your account.">
							<Input value={email} type="email" onChange={({ detail }) => setEmail(detail.value)} />
						</FormField>
						<FormField label="Password" constraintText="Minimum 8 characters.">
							<Input
								value={password}
								type="password"
								onChange={({ detail }) => setPassword(detail.value)}
							/>
						</FormField>
						{submitted && (
							<FormField label="Submitted as">
								<Input value={submitted} readOnly={true} />
							</FormField>
						)}
					</SpaceBetween>
				</Container>
			</Form>
		</form>
	);
}
