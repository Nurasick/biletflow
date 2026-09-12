import { Text, View, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import {Image} from "expo-image";


export default function About() {
  return (
    <View style={styles.container}>
      <Text style={styles.helloworld}>Hello world!</Text>
      <Image 
        source={{
          uri:"https://avatars.fastly.steamstatic.com/ce0256658e8bed88194d0ecf4e8f11c6ea1f9269_full.jpg",
          }}
          style={styles.img}
      />
      <TextInput placeholder="Enter text here..." />
      <ActivityIndicator size="large" color="#0000ff" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  img: {
    width : 200,
    height: 300
  },
  helloworld: {
    fontSize: 20,
    fontWeight: "bold",
    color: "red"
  },
});