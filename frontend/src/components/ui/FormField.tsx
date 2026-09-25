import BaseFormField, { type FormFieldProps } from '@cloudscape-design/components/form-field';
import HelpText, { useHelpOn } from '../HelpText';

/** label / constraintText / errorText 常显；description 仅放补充说明。 */
export default function FormField({ description, ...props }: FormFieldProps) {
  const show = useHelpOn();
  return <BaseFormField {...props} description={show && description ? <HelpText inline>{description}</HelpText> : undefined} />;
}
