export interface EditorConfigProps {
  indent_style?: 'tab' | 'space';
  indent_size?: number;
  tab_width?: number;
  end_of_line?: 'lf' | 'crlf' | 'cr';
  trim_trailing_whitespace?: boolean;
  insert_final_newline?: boolean;
  charset?: string;
}
