// A chat with nothing in it yet says where it was opened (src/blankchat.test.tsx).
import { mount, View } from 'nsh'
import { BlankChat } from '../blankchat.tsx'

mount(() => <View class="flex-1 bg-background"><BlankChat title="payments-api" path="/home/me/code/payments-api" /></View>)
