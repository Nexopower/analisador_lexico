def calcular_promedio(a, b, c):
    suma = a + b + c
    promedio = suma / 3
    return promedio

def es_aprobado(nota):
    if nota >= 60:
        resultado = True
    else:
        resultado = False
    return resultado

def describir_nota(nota):
    if nota >= 90:
        mensaje = 'Excelente'
    elif nota >= 70:
        mensaje = 'Bueno'
    elif nota >= 60:
        mensaje = 'Aprobado'
    else:
        mensaje = 'Reprobado'
    return mensaje

nota1 = 85
nota2 = 72
nota3 = 90

promedio = calcular_promedio(nota1, nota2, nota3)
aprobado = es_aprobado(promedio)
descripcion = describir_nota(promedio)

contador = 0
while contador < 3:
    contador = contador + 1
